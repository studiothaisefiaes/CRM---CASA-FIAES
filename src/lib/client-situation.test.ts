import { expect, it } from "vitest";
import { clientSituation, type SituationInput } from "./client-situation";

const NOW = Date.parse("2026-10-15T15:00:00Z"); // quinta, 12h em Salvador
const vazio: SituationInput = { lastVisitOn: null, rhythmDays: null, cycleDays: null, nextAppointment: null, activePackage: null, conversation: null, birthday: null };

it("a frase da spec: horário, pacote, última visita e a conversa com a dona", () => {
  const s = clientSituation({
    ...vazio, lastVisitOn: "2026-09-25", rhythmDays: 45,
    nextAppointment: { startsAt: "2026-10-16T17:00:00Z", professionalName: "MAIARA" },
    activePackage: { usedSessions: 3, totalSessions: 4 },
    conversation: { stageName: "Aguardando cliente", stageKind: "followup", ownerName: "Sara Lima", enteredAt: "2026-10-15T13:00:00Z", awaitingSince: null, late: false },
  }, NOW);
  expect(s.sentence).toBe("Tem horário amanhã 14:00 com Maiara · pacote 3/4 · última visita há 20 dias · na etapa Aguardando cliente há 2 h com Sara");
  expect(s.states).toEqual([]);
  expect(s.short).toBe("Tem horário amanhã 14:00 com Maiara · última visita há 20 dias");
});

it("sumida: diz quando era a volta e quanto atrasou; estado Sumida", () => {
  const s = clientSituation({ ...vazio, lastVisitOn: "2026-07-01", rhythmDays: 40 }, NOW);
  expect(s.sentence).toBe("última visita há 106 dias · sumida (volta prevista 10/08, atrasada 66 dias)");
  expect(s.states).toEqual(["sumida"]);
  expect(s.short).toBe("Sumida · última visita há 106 dias");
});

it("cliente nova sem nome, número oculto, esperando a Casa e sem dona: sem NaN, -1 ou undefined", () => {
  const s = clientSituation({ ...vazio, conversation: { stageName: "Novo contato", stageKind: "lead", ownerName: null, enteredAt: "2026-10-15T14:55:00Z", awaitingSince: "2026-10-15T14:55:00Z", late: true } }, NOW);
  expect(s.sentence).toBe("ainda não veio à Casa · esperando resposta da Casa há 5 min, sem dono");
  expect(s.states).toEqual(["sem_dono", "atrasada"]);
  expect(s.short).toBe("Esperando resposta, atrasada · Sem dono");
  expect(s.sentence + s.short).not.toMatch(/NaN|undefined|null|-\d|lid:/);
});

it("na hora de voltar e aniversário nesta semana", () => {
  const s = clientSituation({ ...vazio, lastVisitOn: "2026-09-01", rhythmDays: 40, birthday: { day: 17, month: 10 } }, NOW);
  expect(s.sentence).toBe("última visita há 44 dias · hora de voltar (prevista 11/10) · aniversário 17/10");
  expect(s.states).toEqual(["na_hora_de_voltar", "aniversario"]);
});

it("conversa numa etapa do funil: 'na etapa Agendado' (nunca 'conversa agendado')", () => {
  const s = clientSituation({ ...vazio, conversation: { stageName: "Agendado", stageKind: "agendado", ownerName: "Sara Lima", enteredAt: "2026-10-15T13:00:00Z", awaitingSince: null, late: false } }, NOW);
  expect(s.sentence).toBe("ainda não veio à Casa · na etapa Agendado há 2 h com Sara");
});
