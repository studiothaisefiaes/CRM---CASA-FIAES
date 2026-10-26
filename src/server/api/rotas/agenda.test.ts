import { beforeEach, describe, expect, it } from "vitest";
import { eq, like, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { appointments, auditLog, deals, outbox } from "@/server/db/schema";
import { resetDb } from "../../../../test/db";
import { cliente, setSetting, setupAgenda } from "../../../../test/agenda-fixtures";
import { chamar, chaveDe, pessoa } from "../../../../test/api-fixtures";
import { __zerarLimites } from "../limite";
import { isoBahia, textoSemEscopo } from "../rota";
import { alterarHorario, listarAgenda, listarProfissionais, listarServicos, marcarHorario } from "./agenda";

/** Daqui a `dias` dias, às `h` horas em Salvador (sempre no futuro: marcar e confirmar exigem). */
const futuro = (dias: number, h: number) => {
  const d = new Date(Date.now() + dias * 86_400_000 - 3 * 3_600_000).toISOString().slice(0, 10);
  return new Date(`${d}T${String(h).padStart(2, "0")}:00:00-03:00`);
};
const diaDe = (d: Date) => isoBahia(d).slice(0, 10);

let s: Awaited<ReturnType<typeof setupAgenda>>;
beforeEach(async () => { await resetDb(); __zerarLimites(); s = await setupAgenda(); });

type Horario = { id: string; status: string; inicio: string; profissional: { id: string; nome: string } | null; servico: { nome: string }; valor_centavos: number | null; observacao: string | null };

async function marcar(k: string, contactId: string, inicio: Date, extra: Record<string, unknown> = {}) {
  return chamar(marcarHorario, { chave: k, body: { cliente: { contato_id: contactId }, inicio: isoBahia(inicio), servicos: [{ servico_id: s.corte.id, profissional_id: s.ana.id, preferencia: "escolhida" }], ...extra } });
}

describe("agenda", () => {
  it("marca pelo createVisit (sem mandar nada), aparece no período e a mesma chave_pedido não duplica", async () => {
    const u = await pessoa("atendente");
    const k = await chaveDe(u.id, ["ler", "escrever"]);
    const c = await cliente("Paula Souza", { stage: "lead", conversaHaDias: 1 });
    const inicio = futuro(7, 10);
    const chave_pedido = "4a7a2b0e-6a7b-4c9d-8e1f-0a1b2c3d4e5f";
    const r = await marcar(k, c.contactId, inicio, { chave_pedido, observacao: "Primeira vez" });
    expect(r.status).toBe(201);
    const d = r.json.dados as { visita_id: string; reaproveitado: boolean; horarios: Horario[] };
    expect(d.reaproveitado).toBe(false);
    expect(d.horarios[0]).toMatchObject({ status: "agendado", inicio: isoBahia(inicio), profissional: { id: s.ana.id }, servico: { nome: "Corte" }, valor_centavos: null });
    expect(await db.select().from(auditLog).where(eq(auditLog.action, "agendamento_marcado"))).toHaveLength(1);
    expect(await db.select().from(outbox)).toHaveLength(0);

    const de = diaDe(inicio);
    const lista = await chamar(listarAgenda, { chave: k, query: { de, ate: de } });
    expect((lista.json.dados as Horario[]).map((h) => h.id)).toEqual([d.horarios[0].id]);
    expect((await chamar(listarAgenda, { chave: k, query: { de, ate: de, profissional: s.bia.id } })).json.dados).toEqual([]);

    const de2 = await marcar(k, c.contactId, inicio, { chave_pedido });
    expect((de2.json.dados as { reaproveitado: boolean }).reaproveitado).toBe(true);
    expect(await db.select().from(appointments)).toHaveLength(1);
  });

  it("preferência é obrigatória (como na tela); marcador pede agenda.marcador; período longo e sem fuso são recusados", async () => {
    const k = await chaveDe((await pessoa(["atendimento.ver", "agenda.marcar"])).id);
    const c = await cliente();
    const sem = await chamar(marcarHorario, { chave: k, body: { cliente: { contato_id: c.contactId }, inicio: isoBahia(futuro(7, 10)), servicos: [{ servico_id: s.corte.id, profissional_id: s.ana.id }] } });
    expect(sem.status).toBe(400);
    expect(sem.json.erro).toMatch(/^servicos\.0\.preferencia/);
    expect((await marcar(k, c.contactId, futuro(7, 11), { tipo: "noiva" })).status).toBe(403);
    expect((await chamar(listarAgenda, { chave: k, query: { de: "2026-01-01", ate: "2026-06-01" } })).json.erro).toMatch(/62 dias/);
    expect((await chamar(marcarHorario, { chave: k, body: { cliente: { contato_id: c.contactId }, inicio: "2026-11-10T10:00:00", servicos: [] } })).json.erro).toMatch(/^inicio/);
  });

  it("encaixe por cima de outro horário só com encaixe:true e a permissão de encaixar", async () => {
    const semEncaixe = await chaveDe((await pessoa(["atendimento.ver", "agenda.marcar"])).id);
    const comEncaixe = await chaveDe((await pessoa("atendente")).id);
    const inicio = futuro(8, 10);
    expect((await marcar(comEncaixe, (await cliente("Cliente Um")).contactId, inicio)).status).toBe(201);
    const outra = (await cliente("Cliente Dois")).contactId;
    expect((await marcar(semEncaixe, outra, inicio, { encaixe: true })).status).toBe(400);
    const ok = await marcar(comEncaixe, outra, inicio, { encaixe: true });
    expect(ok.status).toBe(201);
  });

  it("remarcar com o lembrete ligado manda o \"remarcado\": exige 'enviar'; avisar_cliente=false remarca sem avisar", async () => {
    await setSetting("lembrete_d1", { enabled: true });
    const u = await pessoa("atendente");
    const soEscrever = await chaveDe(u.id, ["ler", "escrever"]);
    const c = await cliente("Paula Souza", { stage: "lead", conversaHaDias: 1 });
    const h = ((await marcar(soEscrever, c.contactId, futuro(9, 10))).json.dados as { horarios: Horario[] }).horarios[0];
    const remarcados = () => db.select().from(outbox).where(like(sql`${outbox.options}->>'source'`, "lembrete_d1_remarcado:%"));

    expect(await chamar(alterarHorario, { chave: soEscrever, params: { id: h.id }, body: { inicio: isoBahia(futuro(9, 14)) } })).toMatchObject({ status: 403, json: { erro: textoSemEscopo("enviar") } });
    const [antes] = await db.select({ startsAt: appointments.startsAt }).from(appointments).where(eq(appointments.id, h.id));
    expect(isoBahia(antes.startsAt)).toBe(isoBahia(futuro(9, 10)));

    const semAvisar = await chamar(alterarHorario, { chave: soEscrever, params: { id: h.id }, body: { inicio: isoBahia(futuro(9, 14)), avisar_cliente: false } });
    expect(semAvisar.status).toBe(200);
    expect((semAvisar.json.dados as Horario).inicio).toBe(isoBahia(futuro(9, 14)));
    expect(await remarcados()).toHaveLength(0);

    const comEnviar = await chaveDe(u.id, ["escrever", "enviar"]);
    const r = await chamar(alterarHorario, { chave: comEnviar, params: { id: h.id }, body: { inicio: isoBahia(futuro(9, 15)), profissional_id: s.bia.id, confirmar_troca_profissional: true } });
    expect(r.status).toBe(200);
    expect((r.json.dados as Horario).profissional?.id).toBe(s.bia.id);
    expect(await remarcados()).toHaveLength(1);
  });

  it("muda a situação pelos caminhos do domínio: confirmar, observação e cancelar com motivo", async () => {
    const k = await chaveDe((await pessoa("atendente")).id, ["escrever"]);
    const c = await cliente();
    const h = ((await marcar(k, c.contactId, futuro(10, 10))).json.dados as { horarios: Horario[] }).horarios[0];
    expect((await chamar(alterarHorario, { chave: k, params: { id: h.id }, body: { status: "confirmado" } })).json.dados).toMatchObject({ status: "confirmado" });
    expect((await chamar(alterarHorario, { chave: k, params: { id: h.id }, body: { observacao: "Chega 10 min antes" } })).json.dados).toMatchObject({ observacao: "Chega 10 min antes" });
    expect((await chamar(alterarHorario, { chave: k, params: { id: h.id }, body: { status: "cancelado" } })).json.erro).toMatch(/motivo/);
    const r = await chamar(alterarHorario, { chave: k, params: { id: h.id }, body: { status: "cancelado", motivo: "cliente_desmarcou" } });
    expect(r.json.dados).toMatchObject({ status: "cancelado", motivo_cancelamento: "cliente_desmarcou" });
    // Só Ver Conversas (sem agenda.marcar): confirmar sim; cancelar não.
    const soVer = await chaveDe((await pessoa(["atendimento.ver"])).id, ["escrever"]);
    const h2 = ((await marcar(k, (await cliente("Outra Cliente")).contactId, futuro(10, 14))).json.dados as { horarios: Horario[] }).horarios[0];
    expect((await chamar(alterarHorario, { chave: soVer, params: { id: h2.id }, body: { status: "cancelado", motivo: "engano" } })).status).toBe(403);
    expect((await chamar(alterarHorario, { chave: soVer, params: { id: h2.id }, body: { status: "confirmado" } })).status).toBe(200);
    expect((await chamar(alterarHorario, { chave: k, params: { id: "00000000-0000-4000-8000-000000000000" }, body: { status: "confirmado" } })).status).toBe(404);
  });

  it("valida tudo antes da primeira escrita: remarcação ou situação recusada não deixa a observação salva", async () => {
    const k = await chaveDe((await pessoa("atendente")).id, ["escrever"]);
    const h = ((await marcar(k, (await cliente()).contactId, futuro(11, 10))).json.dados as { horarios: Horario[] }).horarios[0];
    const obs = async () => (await db.select({ notes: appointments.notes }).from(appointments).where(eq(appointments.id, h.id)))[0].notes;
    // Falta num horário que ainda não começou: recusada, e a observação não fica.
    const falta = await chamar(alterarHorario, { chave: k, params: { id: h.id }, body: { observacao: "Avisou que atrasa", status: "faltou" } });
    expect(falta.status).toBe(400);
    expect(falta.json.erro).toMatch(/falta depois do horário/);
    expect(await obs()).toBeNull();
    // Remarcar e mudar a situação no mesmo pedido: não (a situação depende do horário novo).
    expect((await chamar(alterarHorario, { chave: k, params: { id: h.id }, body: { inicio: isoBahia(futuro(11, 15)), status: "confirmado", avisar_cliente: false } })).status).toBe(400);
    // Remarcar um horário cancelado: recusa, e a observação não fica.
    await db.update(appointments).set({ status: "cancelado" }).where(eq(appointments.id, h.id));
    const rem = await chamar(alterarHorario, { chave: k, params: { id: h.id }, body: { observacao: "Trocar para a tarde", inicio: isoBahia(futuro(11, 15)), avisar_cliente: false } });
    expect(rem.status).toBe(400);
    expect(await obs()).toBeNull();
    // A auditoria grava o status real.
    const rows = await db.select({ data: auditLog.data }).from(auditLog).where(eq(auditLog.action, "PATCH /agenda/{id}"));
    expect(rows.map((r) => (r.data as { status: number }).status)).toEqual([400, 400, 400]);
  });

  it("GET /agenda não devolve o conversa_id de conversa fora do escopo da pessoa", async () => {
    const ana = await pessoa("atendente", "Ana");
    const bia = await pessoa("atendente", "Bia");
    const k = await chaveDe(ana.id, ["ler", "escrever"]);
    const c = await cliente("Cliente da Bia", { stage: "lead", conversaHaDias: 1 });
    const minha = await cliente("Cliente da Ana", { stage: "lead", conversaHaDias: 1 });
    await db.update(deals).set({ ownerId: bia.id }).where(eq(deals.id, c.dealId!));
    await db.update(deals).set({ ownerId: ana.id }).where(eq(deals.id, minha.dealId!));
    const inicio = futuro(12, 10);
    expect((await marcar(k, c.contactId, inicio, { conversa_id: c.dealId })).status).toBe(201);
    expect((await marcar(k, minha.contactId, futuro(12, 14), { conversa_id: minha.dealId })).status).toBe(201);
    const de = diaDe(inicio);
    const porContato = (j: { dados?: unknown }) => Object.fromEntries((j.dados as (Horario & { contato: { id: string }; conversa_id: string | null })[]).map((h) => [h.contato.id, h.conversa_id]));
    expect(porContato((await chamar(listarAgenda, { chave: k, query: { de, ate: de } })).json)).toEqual({ [c.contactId]: null, [minha.contactId]: minha.dealId });
    const g = await chaveDe((await pessoa("gestao")).id, ["ler"]);
    expect(porContato((await chamar(listarAgenda, { chave: g, query: { de, ate: de } })).json)).toEqual({ [c.contactId]: c.dealId, [minha.contactId]: minha.dealId });
  });

  it("profissionais e serviços (preço só para quem vê valores)", async () => {
    const at = await chaveDe((await pessoa("atendente")).id, ["ler"]);
    const ge = await chaveDe((await pessoa("gestao")).id, ["ler"]);
    const pros = (await chamar(listarProfissionais, { chave: at })).json.dados as { id: string; servico_ids: string[] }[];
    expect(pros.map((p) => p.id)).toEqual([s.ana.id, s.bia.id]);
    expect(pros[0].servico_ids).toContain(s.corte.id);
    const corteAt = (await chamar(listarServicos, { chave: at })).json.dados as { id: string; preco_centavos: number | null }[];
    const corteGe = (await chamar(listarServicos, { chave: ge })).json.dados as { id: string; preco_centavos: number | null }[];
    expect(corteAt.find((x) => x.id === s.corte.id)?.preco_centavos).toBeNull();
    expect(corteGe.find((x) => x.id === s.corte.id)?.preco_centavos).toBe(12000);

  });
});
