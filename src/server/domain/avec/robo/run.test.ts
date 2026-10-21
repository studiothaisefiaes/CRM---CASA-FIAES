import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../../db";
import { agendaBlocks, alerts, avecReports } from "../../../db/schema";
import { resetDb } from "../../../../../test/db";
import { AvecLoginError, runRobo, type AvecSource } from "./run";
import { getRoboConfig, getRoboLast, saveRoboConfig } from "./settings";

const BLOQ = ["Data inicial", "Data final", "Hora inicial", "Hora final", "Profissional", "Titulo", "obs", "Serviço", "Periodo da semana"];
const PROF = ["ID", "Nome", "Cargo", "CPF", "Apelido", "Especialidade", "Contratação", "Grupo de acesso", "Data Cadastro"];
const now = new Date("2026-10-19T02:30:00Z");

function fake(over: Record<string, () => Promise<{ headers: string[]; aaData: unknown }>> = {}): AvecSource & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async fetchReport(code) {
      calls.push(code);
      if (over[code]) return over[code]();
      if (code === "0159") return { headers: BLOQ, aaData: [["20/10/2026", "20/10/2026", "09:00", "10:00", "<b>ANA</b>", "Folga", "", "", "Ter"]] };
      if (code === "0229") return { headers: PROF, aaData: [] };
      throw new Error("tela não existe neste simulado");
    },
  };
}

beforeEach(async () => { await resetDb(); });

describe("robô do Avec (Avec simulado)", () => {
  it("dry-run baixa e conta, sem gravar nada", async () => {
    const src = fake();
    const r = await runRobo(src, { now, dryRun: true, only: ["0159"] });
    expect(r.dryRun).toBe(true);
    expect(r.relatorios).toEqual([{ codigo: "0159", titulo: "Bloqueios da agenda", linhas: 1 }]);
    expect(await db.select().from(avecReports)).toHaveLength(0);
    expect(await getRoboLast()).toBeNull();
    expect(await db.select().from(alerts)).toHaveLength(0);
  });

  it("entrega ao importador, grava avec_robo_ultimo e não avisa quando está tudo certo", async () => {
    const r = await runRobo(fake(), { now, only: ["0159"] });
    expect(r.ok).toBe(true);
    expect(await db.select().from(agendaBlocks)).toHaveLength(1);
    const last = await getRoboLast();
    expect(last?.ok).toBe(true);
    expect(last?.relatorios[0].linhas).toBe(1);
    expect(last?.linhasNovas).toBeGreaterThan(0);
    expect(await db.select().from(alerts)).toHaveLength(0);
    // de novo: idempotente
    await runRobo(fake(), { now, only: ["0159"] });
    expect(await db.select().from(agendaBlocks)).toHaveLength(1);
  });

  it("um relatório com a tela mudada falha sozinho e avisa o sino da gestão (1 por dia)", async () => {
    const src = fake({ "0229": async () => ({ headers: ["Outra", "Coisa"], aaData: [] }) });
    const r = await runRobo(src, { now, only: ["0159", "0229"] });
    expect(r.ok).toBe(false);
    expect(r.relatorios.find((x) => x.codigo === "0159")?.erro).toBeUndefined();
    expect(await db.select().from(agendaBlocks)).toHaveLength(1);
    await runRobo(src, { now, only: ["0159", "0229"] });
    const a = await db.select().from(alerts).where(eq(alerts.type, "avec_robo"));
    expect(a).toHaveLength(1);
    expect(a[0].audience).toBe("gestao");
    expect(a[0].message).toContain("0229");
    expect((await getRoboLast())?.ok).toBe(false);
  });

  it("login recusado para tudo e avisa", async () => {
    const src = fake({ "0159": async () => { throw new AvecLoginError("O Avec não aceitou o login da Casa."); } });
    const r = await runRobo(src, { now, only: ["0159", "0229"] });
    expect(src.calls).toEqual(["0159"]);
    expect(r.erros).toEqual(["O Avec não aceitou o login da Casa."]);
    expect(await db.select().from(alerts)).toHaveLength(1);
  });

  it("a semanal só conta como feita quando TODOS os relatórios semanais rodaram (QA r66, I-2)", async () => {
    // Só um relatório semanal (`only`): a rodada semanal não foi feita.
    await runRobo(fake(), { now, only: ["0229"], forceWeekly: true });
    expect((await getRoboLast())?.semanalEm).toBeNull();
    // Rodada que nem pediu semanal ('only' de relatório diário) com a semanal vencida.
    await resetDb();
    await runRobo(fake(), { now, only: ["0159"] });
    expect((await getRoboLast())?.semanalEm).toBeNull();
    // Login recusado no primeiro relatório: nada rodou.
    await resetDb();
    const src = fake({ "0159": async () => { throw new AvecLoginError("O Avec não aceitou o login da Casa."); } });
    await runRobo(src, { now, forceWeekly: true });
    expect((await getRoboLast())?.semanalEm).toBeNull();
    // Erro no meio.
    await resetDb();
    await runRobo(fake({ "0229": async () => { throw new Error("fora do ar"); } }), { now, only: ["0229"], forceWeekly: true });
    expect((await getRoboLast())?.semanalEm).toBeNull();
  });

  it("configuração: padrão ligado às 20h; salva com validação", async () => {
    expect(await getRoboConfig()).toEqual({ ativo: true, hora: 20 });
    await expect(saveRoboConfig({ ativo: true, hora: 25 }, "00000000-0000-0000-0000-000000000000")).rejects.toThrow(/hora/);
  });
  it("rodada parcial (a de hora em hora da agenda, 20/10) não vira a última rodada do dia", async () => {
    await runRobo(fake(), { now, only: ["0159"], partial: true });
    expect(await getRoboLast()).toBeNull();
    expect(await db.select().from(agendaBlocks)).toHaveLength(1);
  });
});
