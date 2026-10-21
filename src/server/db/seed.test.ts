import { describe, it, expect, beforeAll } from "vitest";
import { eq, ne } from "drizzle-orm";
import { db } from "./index";
import { seed } from "./seed";
import { resetDb } from "../../../test/db";
import { stages, automations, lists } from "./schema";
import { DEFAULT_AUTOMATIONS } from "./seed-data";
import { pendingVars } from "@/lib/quick-reply";

describe("seed", () => {
  beforeAll(resetDb);
  it("é idempotente", async () => {
    await seed(db); await seed(db);
    expect((await db.select().from(stages)).length).toBe(13); // + Na Casa (0035)
    expect((await db.select().from(automations)).length).toBe(10); // Plano 5: sem lembrete_agendamento e confirmacao_d1
    expect((await db.select().from(lists).where(ne(lists.kind, "service"))).length).toBe(27); // Lote 2: + motivo de perda "Retorno não feito"; Lote 5: + 4 respostas prontas
  });
  it("nenhuma automação do seed manda mensagem: o lembrete da véspera é só o de Configurações › Mensagens (Plano 5)", async () => {
    await seed(db);
    const rows = await db.select().from(automations);
    expect(rows.filter((a) => (a.actions as { type: string }[]).some((x) => x.type.startsWith("enviar_")))).toEqual([]);
    expect(DEFAULT_AUTOMATIONS.map((a) => a.key)).not.toContain("lembrete_agendamento");
    expect(DEFAULT_AUTOMATIONS.map((a) => a.key)).not.toContain("confirmacao_d1");
  });
  it("funil da nova organização (16/10): 8 etapas ativas na ordem da jornada; Aguardando cliente, Fechado e Follow-up 2 a 4 desativadas", async () => {
    const rows = await db.select().from(stages).orderBy(stages.position);
    expect(rows.filter((s) => s.active).map((s) => s.name)).toEqual([
      "Novo contato", "Em conversa", "Orçamento", "Agendado", "Na Casa", "Atendida", "Hora de voltar", "Perdido",
    ]);
    expect(rows.filter((s) => !s.active).map((s) => s.key)).toEqual(["followup_1", "fechado", "followup_2", "followup_3", "followup_4"]);
  });
  it("Na Casa (0035) num banco que já tinha o funil: nasce logo depois de Agendado e as seguintes andam uma posição, uma vez só", async () => {
    // Como em produção antes da 0035: sem Na Casa, Atendida na posição 5 e a gestão com uma etapa própria no fim.
    await db.delete(stages).where(eq(stages.key, "na_casa"));
    for (const [key, position] of [["atendida", 5], ["retorno", 6], ["fechado", 7], ["perdido", 8]] as const) await db.update(stages).set({ position }).where(eq(stages.key, key));
    await seed(db);
    const order = async () => (await db.select().from(stages).where(eq(stages.active, true)).orderBy(stages.position)).map((s) => s.key);
    expect(await order()).toEqual(["lead", "atendimento", "orcamento", "agendado", "na_casa", "atendida", "retorno", "perdido"]);
    // A gestão reordena depois: o seed não mexe de novo.
    await db.update(stages).set({ position: 50 }).where(eq(stages.key, "na_casa"));
    await seed(db);
    expect((await order()).at(-1)).toBe("na_casa");
    await resetDb(); // os outros testes deste bloco partem do seed limpo
  });
  it("o seed não desfaz o Lote 0 (15/10): escalada em 30 min; follow-up diário e parado de 1 dia nascem desligados", async () => {
    await seed(db);
    const byKey = new Map((await db.select().from(automations)).map((a) => [a.key, a]));
    expect(byKey.get("gestao_10min")!.trigger).toMatchObject({ type: "sem_resposta_minutos", minutes: 30 });
    expect(byKey.get("followup_diario")!.enabled).toBe(false);
    expect(byKey.get("parado_1dia")!.enabled).toBe(false);
    // conversa esperando resposta em Orçamento, Atendida e Retorno também avisa e escala
    for (const k of ["atendimento_3min", "gestao_10min"]) expect((byKey.get(k)!.conditions as { stages: string[] }[])[0].stages).toEqual(expect.arrayContaining(["orcamento", "atendida", "retorno"]));
  });
  it("não cria serviços: os nomes vêm da Casa (cadastrados em Configurações › Listas › Serviços)", async () => {
    await db.delete(lists).where(eq(lists.kind, "service")); // resetDb põe os serviços de teste
    await seed(db);
    expect(await db.select().from(lists).where(eq(lists.kind, "service"))).toHaveLength(0);
  });
  it("8 respostas prontas universais de partida, com pasta e só variáveis conhecidas (rascunhos editáveis)", async () => {
    await seed(db);
    const qr = await db.select().from(lists).where(eq(lists.kind, "quick_reply"));
    expect(qr.map((q) => q.label).sort()).toEqual(["aniversario", "avaliacao", "boas-vindas", "confirmar", "endereco", "fotos-cabelo", "pos-atendimento", "retomar"]);
    for (const q of qr) {
      expect(q.category, q.label).toBeTruthy();
      expect((q.meta as { ownerId?: string } | null)?.ownerId, q.label).toBeUndefined();
      const unknown = [...(q.body ?? "").matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]).filter((k) => !pendingVars(`{${k}}`).length && !["primeiro_nome", "nome", "saudacao"].includes(k));
      expect(unknown, q.label).toEqual([]);
      expect((q.body ?? "").length, q.label).toBeLessThan(400);
    }
  });
});
