import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { automationRuns, automations, contactTags, outbox, tags, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { setSetting } from "../../../test/agenda-fixtures";
import { recordInbound } from "../domain/deals";
import { saveAutomation } from "../domain/config";
import { AFTER_VISIT_DEFAULTS } from "@/lib/after-visit";
import { VIRADA_FALTA, VIRADA_ITENS } from "@/lib/virada";
import { SATISFACTION_OPTIONS } from "../domain/satisfaction";
import { sendsMessages } from "./templates";
import { ACTION_LABELS, automationInputSchema, type Action, type AutomationInput } from "./types";
import { runRules } from "./engine";

const T0 = new Date("2026-10-13T13:00:00Z"); // terça-feira, 10h em Salvador (expediente)
const min = (n: number) => new Date(T0.getTime() + n * 60_000);
const base = (actions: Action[]): AutomationInput => ({ name: "Pesquisa", enabled: false, trigger: { type: "sem_resposta_minutos", minutes: 2 }, conditions: [], actions });

async function lead() {
  const r = await recordInbound({ channelId: null, externalId: `m-${T0.getTime()}`, phoneRaw: "71999812244", pushName: "Mariana", body: "oi", at: T0 });
  if (!("dealId" in r)) throw new Error("sem deal");
  return r;
}

describe("regra: Mandar a Pesquisa de satisfação (pedir_avaliacao)", () => {
  let gestora = "";
  beforeEach(async () => {
    await resetDb();
    await db.update(automations).set({ enabled: false });
    [{ id: gestora }] = await db.insert(users).values({ name: "Gestora", email: "g@c.com", role: "gestor", passwordHash: "x" }).returning();
  });

  it("formato, rótulo e trava de envio real: ligar a regra pede a confirmação", async () => {
    expect(automationInputSchema.safeParse(base([{ type: "pedir_avaliacao" }])).success).toBe(true);
    expect(ACTION_LABELS.pedir_avaliacao).toBe("Mandar a Pesquisa de satisfação");
    expect(sendsMessages([{ type: "pedir_avaliacao" }])).toBe(true);
    await expect(saveAutomation(null, { ...base([{ type: "pedir_avaliacao" }]), enabled: true }, gestora)).rejects.toThrow("Confirme o envio real para ligar.");
  });

  it("Depois do atendimento fora do modo pesquisa: a regra registra o erro e as outras ações seguem", async () => {
    await db.insert(automations).values({ ...base([{ type: "pedir_avaliacao" }, { type: "por_etiqueta", tag: "Pediu avaliação" }]), enabled: true });
    const { dealId } = await lead();
    const s = await runRules(min(2));
    expect(s.errors).toEqual([`Pesquisa / ${dealId}: Ligue a Pesquisa de satisfação em Depois do atendimento.`]);
    expect(await db.select().from(outbox)).toHaveLength(0);
    const [run] = await db.select().from(automationRuns);
    expect(run.result).toMatchObject({ acoes: ["etiqueta"], erros: ["Ligue a Pesquisa de satisfação em Depois do atendimento."] });
    expect((await db.select({ name: tags.name }).from(contactTags).innerJoin(tags, eq(tags.id, contactTags.tagId))).map((t) => t.name)).toEqual(["Pediu avaliação"]);
  });

  it("modo pesquisa sem a Virada do Depois do atendimento (ruling R7): a regra registra o erro e não manda nada", async () => {
    await setSetting("depois_atendimento", { ...AFTER_VISIT_DEFAULTS, mode: "pesquisa", linkGoogle: "https://g.page/r/casa-fiaes/review" });
    await setSetting("virada_depois", { alvo: "depois", marcados: ["texto_conferido", "teste_enviado"], quem: gestora, quando: T0.toISOString() });
    await db.insert(automations).values({ ...base([{ type: "pedir_avaliacao" }]), enabled: true });
    const { dealId } = await lead();
    const s = await runRules(min(2));
    expect(s.errors).toEqual([`Pesquisa / ${dealId}: ${VIRADA_FALTA.depois}`]);
    expect(await db.select().from(outbox)).toHaveLength(0);
  });

  it("com o modo pesquisa: a enquete de 1 a 5 entra na fila com o título da configuração", async () => {
    await setSetting("virada_depois", { alvo: "depois", marcados: [...VIRADA_ITENS.depois], quem: gestora, quando: T0.toISOString() });
    await setSetting("depois_atendimento", { ...AFTER_VISIT_DEFAULTS, mode: "pesquisa", linkGoogle: "https://g.page/r/casa-fiaes/review", tituloPesquisa: "{primeiro_nome}, que nota você dá para a Casa?" });
    const [auto] = await db.insert(automations).values({ ...base([{ type: "pedir_avaliacao" }]), enabled: true }).returning();
    const { dealId } = await lead();
    const s = await runRules(min(2));
    expect(s.errors).toEqual([]);
    const [row] = await db.select().from(outbox);
    expect(row).toMatchObject({ dealId, kind: "poll", text: "Mariana, que nota você dá para a Casa?", options: { values: [...SATISFACTION_OPTIONS], source: `automacao:${auto.id}` } });
  });
});
